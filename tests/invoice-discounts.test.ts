// findDiscounts: group stored discounted product lines by supplier and item, and word them. Fixtures are the Daniel Street numbers.
import { describe, expect, it } from "vitest";
import { suggestedFromParams } from "../lib/deals";
import {
  dealPrefillHref,
  dealPrefillPct,
  discountsForIngredient,
  findDiscounts,
  groupSizeText,
  ingredientDiscountText,
  lineDiscountText,
  lineNetPerBase,
  listPerBaseOf,
  netText,
  pctOff,
  perUnitText,
  productDiscountTargets,
  seenText,
  shortSupplier,
  steadierText,
  STATUS_WORD,
  type DiscountRow,
} from "../lib/invoice-discounts";

const DS = "sup-daniel-street";

function row(over: Partial<DiscountRow> & { line_id: string; document_id: string }): DiscountRow {
  return {
    supplier_id: DS, supplier_name: "Daniel Street Fish Market", invoice_number: null, invoice_date: null, ingredient_id: "ing-barra", ingredient_name: "Barramundi Fillets (1kg)",
    description: "Humpty Doo Barramundi fillets per kg", discount_pct: null, discount_per_base: null, base_unit: "kg", unit_price_ex: null, qty: null, base_qty: null, ...over,
  };
}

/** #51329: 2.39 kg at $41.54, -$16.45. #9764204: 4.57 kg at $41.50, -$31.52. */
const inv51329 = row({ line_id: "l1", document_id: "d1", invoice_number: "51329", invoice_date: "2026-10-14", discount_pct: 16.45 / 98.98, discount_per_base: 16.45 / 2.39, unit_price_ex: 41.54, qty: 2.39, base_qty: 2.39 });
const inv9764204 = row({ line_id: "l2", document_id: "d2", invoice_number: "9764204", invoice_date: "2026-10-17", discount_pct: 31.52 / 189.66, discount_per_base: 31.52 / 4.57, unit_price_ex: 41.5, qty: 4.57, base_qty: 4.57 });

describe("findDiscounts: the two Daniel Street invoices", () => {
  const [g] = findDiscounts([inv51329, inv9764204]);

  it("is one group for the supplier and the barramundi, with both invoices newest first", () => {
    expect(findDiscounts([inv51329, inv9764204])).toHaveLength(1);
    expect(g.supplier).toBe("Daniel Street Fish Market");
    expect(g.item).toBe("Barramundi Fillets (1kg)");
    expect(g.ingredientId).toBe("ing-barra");
    expect(g.baseUnit).toBe("kg");
    expect(g.invoiceCount).toBe(2);
    expect(g.invoices).toEqual([
      { documentId: "d2", number: "9764204", date: "2026-10-17" },
      { documentId: "d1", number: "51329", date: "2026-10-14" },
    ]);
    expect(g.latest.documentId).toBe("d2");
  });

  it("gives the percentage and the dollars per kilo as min, mean and max", () => {
    expect(g.pct.min).toBeCloseTo(0.166193, 5);
    expect(g.pct.max).toBeCloseTo(0.166195, 5);
    expect(g.pct.mean).toBeCloseTo(0.1662, 4);
    expect(g.perBase!.min).toBeCloseTo(6.8828, 3);
    expect(g.perBase!.max).toBeCloseTo(6.8972, 3);
    expect(g.perBase!.mean).toBeCloseTo(6.89, 2);
  });

  it("measures the spreads: the percentage is flat to a hundredth of a point, the dollars within 0.3%", () => {
    expect(g.pctSpread).toBeLessThan(0.01);
    expect(g.perBaseSpreadRel).toBeLessThan(0.005);
    expect(g.perBaseSpreadRel).toBeGreaterThan(0.001);
  });

  it("is a standing discount, and neither measure is clearly steadier", () => {
    expect(g.status).toBe("standing");
    expect(g.steadier).toBe("tie");
    expect(steadierText(g)).toBeNull();
  });

  it("works out the net cost per kilo from the latest list price and its discount", () => {
    // #9764204: $41.50 list, $6.8972 off
    expect(g.listPerBase).toBe(41.5);
    expect(g.netPerBase).toBeCloseTo(41.5 - 31.52 / 4.57, 3);
    expect(netText(g.netPerBase, g.baseUnit)).toBe("Net $34.60/kg after the discount");
  });

  it("is worded for the owners: both measures, always", () => {
    expect(groupSizeText(g)).toBe("16.6% off, $6.89/kg off");
    expect(seenText(2)).toBe("Seen on 2 invoices");
    expect(seenText(1)).toBe("Seen on 1 invoice");
    expect(STATUS_WORD[g.status]).toBe("Standing");
    expect(ingredientDiscountText(g)).toBe("Daniel Street takes 16.6% ($6.89/kg) off every delivery. Seen on 2 invoices.");
    expect(dealPrefillPct(g)).toBe("16.6");
  });
});

describe("findDiscounts: status", () => {
  it("one invoice is seen once, whatever its size", () => {
    const [g] = findDiscounts([inv51329]);
    expect(g.status).toBe("seen once");
    expect(g.invoiceCount).toBe(1);
    expect(g.steadier).toBe("tie");
    expect(g.pctSpread).toBe(0);
    expect(g.perBaseSpreadRel).toBe(0);
    expect(g.pct.min).toBe(g.pct.max);
    expect(g.listPerBase).toBe(41.54);
  });

  it("two invoices with very different percentages and dollars vary", () => {
    const a = row({ line_id: "a", document_id: "da", invoice_date: "2026-10-01", discount_pct: 0.1, discount_per_base: 4, unit_price_ex: 40, qty: 1, base_qty: 1 });
    const b = row({ line_id: "b", document_id: "db", invoice_date: "2026-10-08", discount_pct: 0.2, discount_per_base: 10, unit_price_ex: 50, qty: 1, base_qty: 1 });
    const [g] = findDiscounts([a, b]);
    expect(g.status).toBe("varies");
    expect(g.pctSpread).toBeCloseTo(10, 6);
  });

  it("standing needs the percentage within half a point OR the dollars within 2%", () => {
    // 10.0% then 10.4%: within half a point, dollars far apart
    const p1 = row({ line_id: "a", document_id: "da", invoice_date: "2026-10-01", discount_pct: 0.1, discount_per_base: 4, unit_price_ex: 40, qty: 1, base_qty: 1 });
    const p2 = row({ line_id: "b", document_id: "db", invoice_date: "2026-10-08", discount_pct: 0.104, discount_per_base: 6.24, unit_price_ex: 60, qty: 1, base_qty: 1 });
    const g1 = findDiscounts([p1, p2])[0];
    expect(g1.pctSpread).toBeCloseTo(0.4, 6);
    expect(g1.status).toBe("standing");
    expect(g1.steadier).toBe("percent");
    expect(steadierText(g1)).toBe("Steadier as a percentage");
    // $5 off a kilo both times: 12.5% then 10%, dollars identical
    const d1 = row({ line_id: "c", document_id: "dc", invoice_date: "2026-10-01", discount_pct: 0.125, discount_per_base: 5, unit_price_ex: 40, qty: 1, base_qty: 1 });
    const d2 = row({ line_id: "d", document_id: "dd", invoice_date: "2026-10-08", discount_pct: 0.1, discount_per_base: 5, unit_price_ex: 50, qty: 1, base_qty: 1 });
    const g2 = findDiscounts([d1, d2])[0];
    expect(g2.pctSpread).toBeCloseTo(2.5, 6);
    expect(g2.perBaseSpreadRel).toBe(0);
    expect(g2.status).toBe("standing");
    expect(g2.steadier).toBe("dollars");
    expect(steadierText(g2)).toBe("Steadier as dollars per kg");
  });

  it("with no dollars per unit (the base quantity was never known) the percentage decides", () => {
    const a = row({ line_id: "a", document_id: "da", invoice_date: "2026-10-01", discount_pct: 0.15 });
    const b = row({ line_id: "b", document_id: "db", invoice_date: "2026-10-08", discount_pct: 0.15 });
    const [g] = findDiscounts([a, b]);
    expect(g.perBase).toBeNull();
    expect(g.perBaseSpreadRel).toBeNull();
    expect(g.status).toBe("standing");
    expect(g.steadier).toBe("percent");
    expect(g.listPerBase).toBeNull();
    expect(g.netPerBase).toBeNull();
    expect(groupSizeText(g)).toBe("15.0% off");
    expect(ingredientDiscountText(g)).toBe("Daniel Street takes 15.0% off every delivery. Seen on 2 invoices.");
  });
});

describe("findDiscounts: grouping and order", () => {
  it("counts an invoice once even when two of its lines carry the discount", () => {
    const second = { ...inv51329, line_id: "l1b" };
    expect(findDiscounts([inv51329, second])[0].invoiceCount).toBe(1);
    expect(findDiscounts([inv51329, second])[0].status).toBe("seen once");
  });

  it("separates suppliers and items; a line with no ingredient groups by its description", () => {
    const other = row({ line_id: "o", document_id: "do", supplier_id: "sup-other", supplier_name: "Other Fish", invoice_date: "2026-10-12", discount_pct: 0.05 });
    const loose = row({ line_id: "x", document_id: "dx", ingredient_id: null, ingredient_name: null, description: "SNAPPER whole per kg", invoice_date: "2026-10-12", discount_pct: 0.07, discount_per_base: null });
    const loose2 = row({ line_id: "y", document_id: "dy", ingredient_id: null, ingredient_name: null, description: "Snapper Whole per KG", invoice_date: "2026-10-19", discount_pct: 0.07 });
    const groups = findDiscounts([inv51329, other, loose, loose2]);
    expect(groups).toHaveLength(3);
    const snapper = groups.find((g) => g.ingredientId == null)!;
    expect(snapper.invoiceCount).toBe(2);
    expect(snapper.item).toBe("Snapper Whole");
    expect(groups.find((g) => g.supplier === "Other Fish")!.invoiceCount).toBe(1);
  });

  it("sorts standing first, then varies, then seen once, and the bigger discount first inside a status", () => {
    const mk = (id: string, ing: string, pcts: number[]) =>
      pcts.map((p, i) => row({ line_id: `${id}${i}`, document_id: `${id}-d${i}`, ingredient_id: ing, ingredient_name: ing, invoice_date: `2026-10-0${i + 1}`, discount_pct: p, discount_per_base: p * 40, unit_price_ex: 40, qty: 1, base_qty: 1 }));
    const rows = [...mk("once", "Once", [0.3]), ...mk("vary", "Varies", [0.1, 0.25]), ...mk("big", "Big", [0.2, 0.2]), ...mk("small", "Small", [0.05, 0.05])];
    expect(findDiscounts(rows).map((g) => `${g.item}:${g.status}`)).toEqual(["Big:standing", "Small:standing", "Varies:varies", "Once:seen once"]);
  });

  it("ignores lines with no percentage, and the empty input gives nothing", () => {
    expect(findDiscounts([])).toEqual([]);
    expect(findDiscounts([row({ line_id: "n", document_id: "dn", discount_pct: null }), row({ line_id: "z", document_id: "dz", discount_pct: 0 })])).toEqual([]);
  });

  it("finds the groups of one ingredient", () => {
    const groups = findDiscounts([inv51329, row({ line_id: "o", document_id: "do", ingredient_id: "ing-other", ingredient_name: "Other", discount_pct: 0.1 })]);
    expect(discountsForIngredient(groups, "ing-barra")).toHaveLength(1);
    expect(discountsForIngredient(groups, "nope")).toEqual([]);
  });
});

describe("words and small helpers", () => {
  it("lists the line text the invoice page shows", () => {
    expect(lineDiscountText({ discount_pct: 16.45 / 98.98, discount_per_base: 16.45 / 2.39, base_unit: "kg" })).toBe("Discount 16.6% ($6.88/kg off)");
    expect(lineDiscountText({ discount_pct: 0.1, discount_per_base: null, base_unit: null })).toBe("Discount 10.0%");
    expect(lineDiscountText({ discount_pct: null, discount_per_base: 2, base_unit: "L" })).toBe("Discount $2.00/L off");
    expect(lineDiscountText({ line_discount_ex: 3 })).toBe("Discount $3.00");
    expect(lineDiscountText({})).toBeNull();
  });

  it("net per unit on one invoice line", () => {
    expect(lineNetPerBase({ unit_price_ex: 41.54, qty: 2.39, base_qty: 2.39, discount_per_base: 16.45 / 2.39 })).toBeCloseTo(34.6572, 3);
    expect(lineNetPerBase({ unit_price_ex: 41.54, qty: 2.39, base_qty: null, discount_per_base: 6.88 })).toBeNull();
    expect(lineNetPerBase({ unit_price_ex: 5, qty: 1, base_qty: 1, discount_per_base: 6 })).toBeNull();
  });

  it("list cost per base unit handles packs (a carton of 6 kg bought as 2 cartons)", () => {
    expect(listPerBaseOf({ unit_price_ex: 60, qty: 2, base_qty: 12 })).toBe(10);
    expect(listPerBaseOf({ unit_price_ex: null, qty: 2, base_qty: 12 })).toBeNull();
    expect(listPerBaseOf({ unit_price_ex: 60, qty: 2, base_qty: 0 })).toBeNull();
  });

  it("formats units and short names", () => {
    expect(perUnitText(6.88, "kg")).toBe("$6.88/kg");
    expect(perUnitText(1, "each")).toBe("$1.00/ea");
    expect(perUnitText(1, null)).toBe("$1.00");
    expect(pctOff(0.1662)).toBe("16.6%");
    expect(shortSupplier("Daniel Street Fish Market")).toBe("Daniel Street");
    expect(shortSupplier("  ")).toBe("The supplier");
  });

  it("no text a person reads holds an em or en dash", () => {
    const [g] = findDiscounts([inv51329, inv9764204]);
    const texts = [groupSizeText(g), seenText(2), ingredientDiscountText(g), netText(g.netPerBase, g.baseUnit), lineDiscountText(inv51329), steadierText({ steadier: "dollars", baseUnit: "L" }), ...Object.values(STATUS_WORD)];
    for (const t of texts) expect(String(t)).not.toMatch(/[–—]/);
  });
});

describe("the sentence on the ingredient page", () => {
  const base = { supplier: "Daniel Street Fish Market", baseUnit: "kg", perBase: { min: 6.88, mean: 6.88, max: 6.88 }, pct: { min: 0.1662, mean: 0.1662, max: 0.1662 } };
  it("standing: takes it off every delivery", () => {
    expect(ingredientDiscountText({ ...base, status: "standing", invoiceCount: 4, latest: { documentId: "d", number: "1", date: "2026-10-17" } })).toBe(
      "Daniel Street takes 16.6% ($6.88/kg) off every delivery. Seen on 4 invoices.",
    );
  });
  it("seen once: says when", () => {
    expect(ingredientDiscountText({ ...base, status: "seen once", invoiceCount: 1, latest: { documentId: "d", number: "1", date: "2026-10-14" } })).toBe(
      "Daniel Street took 16.6% ($6.88/kg) off on 14 Oct. Seen on 1 invoice.",
    );
  });
  it("varies: gives the range", () => {
    const text = ingredientDiscountText({ ...base, pct: { min: 0.1, mean: 0.15, max: 0.2 }, status: "varies", invoiceCount: 3, latest: { documentId: "d", number: "1", date: null } });
    expect(text).toBe("Daniel Street takes between 10.0% and 20.0% off. Seen on 3 invoices.");
  });
});

describe("Add As Standing Discount only fills the Percent Off form in", () => {
  it("builds the address with one decimal", () => {
    const [g] = findDiscounts([inv51329, inv9764204]);
    expect(dealPrefillHref("ing-barra", g)).toBe("/ingredients/ing-barra?deal=percent_off&pct=16.6");
  });
  it("the form reads the address back as a Percent Off suggestion of that size", () => {
    const params = new URLSearchParams("deal=percent_off&pct=16.6");
    expect(suggestedFromParams((k) => params.get(k))).toEqual({ kind: "percent_off", buy_qty: null, free_qty: null, pct_off: 0.166, matched: "" });
  });
  it("anything else opens nothing", () => {
    const read = (q: string) => {
      const p = new URLSearchParams(q);
      return suggestedFromParams((k) => p.get(k));
    };
    expect(read("")).toBeNull();
    expect(read("deal=percent_off")).toBeNull();
    expect(read("deal=percent_off&pct=0")).toBeNull();
    expect(read("deal=percent_off&pct=100")).toBeNull();
    expect(read("deal=percent_off&pct=abc")).toBeNull();
    expect(read("deal=special_price&pct=10")).toBeNull();
    expect(read("pct=10")).toBeNull();
  });
});

describe("productDiscountTargets: which negative line belongs to which product on one invoice", () => {
  const product = { id: "p1", line_class: "product", item_code: "15056", description: "Humpty Doo Barramundi fillets per kg", qty: 2.39, unit_price_ex: 41.54, line_total_ex: 98.98, line_discount_ex: 16.45 };
  const other = { id: "p2", line_class: "product", item_code: "15026", description: "Kingfish fillets", qty: 1.85, unit_price_ex: 68.9, line_total_ex: 127.47, line_discount_ex: null };
  const discount = { id: "d1", line_class: "discount", item_code: "15056", description: "Barramundi credit", qty: null, unit_price_ex: null, line_total_ex: -16.45 };
  it("ties the discount line to the product that carries the stored discount", () => {
    expect([...productDiscountTargets([product, other, discount])]).toEqual([["d1", "p1"]]);
  });
  it("an old credit line (no stored discount on any product) is not a target", () => {
    expect(productDiscountTargets([{ ...product, line_discount_ex: null }, other, { ...discount, line_class: "credit" }]).size).toBe(0);
  });
  it("returned goods stay a credit", () => {
    expect(productDiscountTargets([product, other, { ...discount, line_class: "credit", qty: -0.396, unit_price_ex: 41.54 }]).size).toBe(0);
  });
});
