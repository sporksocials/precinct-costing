import { describe, expect, it } from "vitest";
import { decideLine, evaluateGuards, isSamePrice } from "../lib/invoice-guards";
import type { DecideInput, GuardId } from "../lib/invoice-guards";

/** a line that passes every guard */
const good = (over: Partial<DecideInput> = {}): DecideInput => ({
  duplicate: false,
  supplierKnown: true,
  venueCheck: "ok",
  reconciled: true,
  lineClass: "product",
  mathOk: true,
  matchState: "matched",
  matchMethod: "code",
  unitsKnown: true,
  unitsProblem: null,
  hasPrice: true,
  priceProblem: null,
  qty: 2,
  isCredit: false,
  creditAttachedEx: 0,
  hasDeal: false,
  invoiceDate: "2026-10-14",
  lastPriceUpdate: "2026-10-01",
  today: "2026-10-24",
  changePct: 0.03,
  autoApplyPct: 0.05,
  learningMode: false,
  supplierAutoApply: true,
  allSame: false,
  ...over,
});

describe("decideLine: the auto-apply guards", () => {
  it("applies itself when every guard passes", () => {
    const v = decideLine(good());
    expect(v.decision).toBe("apply");
    expect(v.reason).toBeNull();
    expect(v.guards.every((g) => g.ok)).toBe(true);
  });

  // one row per guard: the input that breaks only that guard, the guard that must stop it, and the words a person reads
  const blocks: [string, Partial<DecideInput>, GuardId, string][] = [
    ["supplier unknown", { supplierKnown: false }, "supplier", "The supplier is new or not confirmed yet."],
    ["venue mismatch", { venueCheck: "mismatch" }, "venue", "The invoice looks like it belongs to another venue."],
    ["venue unknown", { venueCheck: "unknown" }, "venue", "The venue on the invoice is not confirmed."],
    ["not reconciled", { reconciled: false }, "reconciled", "Invoice does not add up."],
    ["line maths wrong", { mathOk: false }, "math", "The line's quantity times price does not match its total."],
    ["line maths unchecked", { mathOk: null }, "math", "The line's maths could not be checked."],
    ["no pack size", { unitsKnown: false }, "units", "The pack size for this unit is not known."],
    ["pack conflict", { unitsProblem: "A saved match says 24 per CTN but the ordering list says 12." }, "units", "A saved match says 24 per CTN but the ordering list says 12."],
    ["no price", { hasPrice: false, priceProblem: "GST is unclear on this line." }, "price", "GST is unclear on this line."],
    ["zero quantity", { qty: 0 }, "delivered", "Nothing was delivered on this line (quantity 0)."],
    ["a credit line", { isCredit: true }, "credit", "This line is a credit, so it does not set a price."],
    ["a credit against the line", { creditAttachedEx: -16.45 }, "credit", "A credit of $16.45 was issued against this line."],
    ["a deal on the product", { hasDeal: true }, "deal", "This product has a deal, so its real price is not the list price."],
    ["older than the current price", { invoiceDate: "2026-09-30", lastPriceUpdate: "2026-10-01" }, "date", "The invoice is older than the price already in the app."],
    ["no invoice date", { invoiceDate: null }, "date", "The invoice date could not be read."],
    ["no last price date", { lastPriceUpdate: null }, "date", "There is no record of when this price last changed."],
    ["invoice dated in the future", { invoiceDate: "2026-11-01" }, "date", "The invoice date is in the future."],
    ["a big rise", { changePct: 0.062 }, "change", "6.2% change is over the 5% limit."],
    ["a big fall", { changePct: -0.12 }, "change", "12.0% change is over the 5% limit."],
    ["exactly at the limit", { changePct: 0.05 }, "change", "5.0% change is at the 5% limit."],
    ["no current price", { changePct: null }, "change", "There is no current price to compare with."],
    ["learning mode", { learningMode: true }, "learning", "Learning mode: every price waits for a tap."],
    ["supplier not trusted", { supplierAutoApply: false }, "supplier_trust", "This supplier is not set to apply prices by itself yet."],
  ];

  it.each(blocks)("%s blocks it", (_name, patch, guard, reason) => {
    const v = decideLine(good(patch));
    expect(v.decision).toBe("needs_approval");
    expect(v.failed?.id).toBe(guard);
    expect(v.reason).toBe(reason);
  });

  it("a match that is not by code, alias or a human is not good enough", () => {
    const v = decideLine(good({ matchMethod: null }));
    expect(v.decision).toBe("needs_approval");
    expect(v.failed?.id).toBe("match");
  });

  it("a change just under the limit passes; the limit is the user's setting", () => {
    expect(decideLine(good({ changePct: 0.0499 })).decision).toBe("apply");
    expect(decideLine(good({ changePct: -0.0499 })).decision).toBe("apply");
    expect(decideLine(good({ changePct: 0.0499, autoApplyPct: 0.02 })).reason).toBe("5.0% change is over the 2% limit.");
  });

  it("the first failing guard names the reason, the real problem before the policy switches", () => {
    const v = decideLine(good({ learningMode: true, changePct: 0.2, supplierAutoApply: false }));
    expect(v.failed?.id).toBe("change");
    expect(v.reason).toBe("20.0% change is over the 5% limit.");
    expect(decideLine(good({ learningMode: true, supplierAutoApply: false })).reason).toBe("Learning mode: every price waits for a tap.");
  });

  it("charges and credits decide nothing; an unmatched or ambiguous line decides none", () => {
    expect(decideLine(good({ lineClass: "delivery" })).decision).toBe("none");
    expect(decideLine(good({ lineClass: "credit" })).decision).toBe("none");
    expect(decideLine(good({ matchState: "unmatched", matchMethod: null }))).toMatchObject({ decision: "none", reason: "No product is matched to this line yet." });
    expect(decideLine(good({ matchState: "ambiguous", matchMethod: null })).decision).toBe("none");
  });

  it("a duplicate decides nothing, and the duplicate guard is the one that fails", () => {
    const v = decideLine(good({ duplicate: true }));
    expect(v.decision).toBe("none");
    expect(v.reason).toBe("This invoice is a copy of one already filed.");
    const g = evaluateGuards(good({ duplicate: true }), "apply").find((x) => !x.ok);
    expect(g?.id).toBe("duplicate");
  });
});

describe("decideLine: a price that equals the current price is confirmed", () => {
  it("is 'same' even in learning mode, with an untrusted supplier, a deal, or a big stale date gap", () => {
    expect(decideLine(good({ allSame: true, changePct: 0, learningMode: true })).decision).toBe("same");
    expect(decideLine(good({ allSame: true, supplierAutoApply: false })).decision).toBe("same");
    expect(decideLine(good({ allSame: true, hasDeal: true })).decision).toBe("same");
    expect(decideLine(good({ allSame: true, lastPriceUpdate: null })).decision).toBe("same");
  });

  it("is not confirmed from an invoice that cannot be trusted, and is not asked about", () => {
    const cases: [Partial<DecideInput>, GuardId][] = [
      [{ reconciled: false }, "reconciled"],
      [{ venueCheck: "mismatch" }, "venue"],
      [{ venueCheck: "unknown" }, "venue"],
      [{ mathOk: false }, "math"],
      [{ supplierKnown: false }, "supplier"],
      [{ unitsKnown: false }, "units"],
      [{ invoiceDate: "2026-09-30", lastPriceUpdate: "2026-10-01" }, "date"],
      [{ invoiceDate: null }, "date"],
    ];
    for (const [patch, guard] of cases) {
      const v = decideLine(good({ allSame: true, changePct: 0, ...patch }));
      expect(v.decision).toBe("none");
      expect(v.failed?.id).toBe(guard);
      expect(v.reason).toMatch(/^The price matches, but it is not confirmed: /);
    }
  });

  it("a duplicate is never confirmed", () => {
    expect(decideLine(good({ allSame: true, duplicate: true })).decision).toBe("none");
  });
});

describe("guards as a checklist", () => {
  it("lists every guard in order for an apply, and a shorter list for a confirm", () => {
    const ids = evaluateGuards(good(), "apply").map((g) => g.id);
    expect(ids).toEqual(["duplicate", "supplier", "venue", "reconciled", "math", "match", "units", "price", "delivered", "credit", "deal", "date", "change", "learning", "supplier_trust"]);
    const confirm = evaluateGuards(good(), "confirm").map((g) => g.id);
    expect(confirm).toEqual(["duplicate", "supplier", "venue", "reconciled", "math", "match", "units", "price", "date"]);
  });

  it("every result carries a label and a reason for a screen to show", () => {
    for (const g of evaluateGuards(good({ learningMode: true }))) {
      expect(g.label.length).toBeGreaterThan(0);
      expect(g.reason.length).toBeGreaterThan(0);
      expect(g.reason).not.toMatch(/[–—]/);
    }
  });

  it("two prices are the same when they differ by less than half a cent", () => {
    expect(isSamePrice(68.9, 68.904)).toBe(true);
    expect(isSamePrice(68.9, 68.91)).toBe(false);
    expect(isSamePrice(68.9, 68.9)).toBe(true);
  });
});
