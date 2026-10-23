import { describe, expect, it } from "vitest";
import { allocateCents, allocateLanded, attachCredits, fromCents, toCents } from "../lib/invoice-landed";
import type { LandedCredit, LandedProduct } from "../lib/invoice-landed";

// a small seeded generator so the property test is the same every run
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("allocateCents", () => {
  it("shares the Daniel Street pool by value: kingfish 3.59, barramundi 2.32, total 5.91", () => {
    const { shares, allocated } = allocateCents(591, [127.47, 82.53]);
    expect(allocated).toBe(true);
    expect(shares).toEqual([359, 232]);
    expect(sum(shares)).toBe(591);
  });

  it("gives the leftover cent to the largest remainder, ties to the larger weight then the first line", () => {
    expect(allocateCents(100, [1, 1, 1]).shares).toEqual([34, 33, 33]);
    expect(allocateCents(1, [1, 2]).shares).toEqual([0, 1]);
    expect(allocateCents(2, [1, 1, 1]).shares).toEqual([1, 1, 0]);
  });

  it("property: shares always add up to the pool to the cent, and none is negative for a positive pool", () => {
    const r = rng(20261024);
    for (let n = 0; n < 2000; n++) {
      const count = 1 + Math.floor(r() * 12);
      const pool = Math.floor(r() * 500000);
      const weights = Array.from({ length: count }, () => (r() < 0.15 ? 0 : Math.round(r() * 100000) / 100));
      const { shares, allocated } = allocateCents(pool, weights);
      if (weights.some((w) => w > 0) || pool === 0) {
        expect(allocated).toBe(true);
        expect(sum(shares)).toBe(pool);
        expect(shares.every((s) => Number.isInteger(s) && s >= 0)).toBe(true);
        // a zero weight never takes a share
        weights.forEach((w, i) => w === 0 && expect(shares[i]).toBe(0));
      } else {
        expect(allocated).toBe(false);
        expect(sum(shares)).toBe(0);
      }
    }
  });

  it("property: a negative pool (a discount) adds up exactly and no share is positive", () => {
    const r = rng(777);
    for (let n = 0; n < 1000; n++) {
      const count = 1 + Math.floor(r() * 8);
      const pool = -Math.floor(r() * 300000) - 1;
      const weights = Array.from({ length: count }, () => 0.01 + Math.round(r() * 5000) / 100);
      const { shares } = allocateCents(pool, weights);
      expect(sum(shares)).toBe(pool);
      expect(shares.every((s) => s <= 0)).toBe(true);
    }
  });

  it("property: quantity weights with four decimals still add up exactly", () => {
    const r = rng(42);
    for (let n = 0; n < 500; n++) {
      const weights = Array.from({ length: 1 + Math.floor(r() * 6) }, () => 0.0001 + Math.round(r() * 2000000) / 10000);
      const pool = Math.floor(r() * 100000);
      expect(sum(allocateCents(pool, weights).shares)).toBe(pool);
    }
  });

  it("cannot share a pool when every weight is zero, and says so", () => {
    expect(allocateCents(591, [0, 0])).toEqual({ shares: [0, 0], allocated: false });
    expect(allocateCents(591, [])).toEqual({ shares: [], allocated: false });
    expect(allocateCents(0, [0, 0]).allocated).toBe(true);
  });

  it("converts dollars and cents without drift", () => {
    expect(toCents(5.9091)).toBe(591);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(fromCents(359)).toBe(3.59);
  });
});

const P = (over: Partial<LandedProduct> & { index: number }): LandedProduct => ({ itemCode: null, description: "x", unit: "KG", qty: 1, baseQty: 1, totalEx: 10, ...over });
const C = (over: Partial<LandedCredit> & { index: number }): LandedCredit => ({ itemCode: null, description: "credit", unit: null, qty: null, totalEx: -1, ...over });

describe("attachCredits", () => {
  it("attaches by item code first", () => {
    const m = attachCredits([P({ index: 0, itemCode: "15026" }), P({ index: 1, itemCode: "15056" })], [C({ index: 2, itemCode: "15056" })]);
    expect(m.get(2)).toBe(1);
  });

  it("falls back to the description key, ignoring a leading Credit word", () => {
    const m = attachCredits(
      [P({ index: 0, description: "Barramundi fillets per kg" })],
      [C({ index: 1, description: "Credit Barramundi fillets per kg" })],
    );
    expect(m.get(1)).toBe(0);
  });

  it("leaves a credit unattached when nothing, or more than one product, could take it", () => {
    expect(attachCredits([P({ index: 0, itemCode: "A" })], [C({ index: 1, itemCode: "Z", description: "Mystery" })]).get(1)).toBeNull();
    const two = attachCredits([P({ index: 0, itemCode: "A" }), P({ index: 1, itemCode: "A" })], [C({ index: 2, itemCode: "A" })]);
    expect(two.get(2)).toBeNull();
  });
});

describe("allocateLanded", () => {
  const kingfish = P({ index: 0, itemCode: "15026", qty: 1.85, baseQty: 1.85, totalEx: 127.47 });
  const barra = P({ index: 1, itemCode: "15056", qty: 2.39, baseQty: 2.39, totalEx: 98.98 });

  it("Daniel Street #51329: pool 5.91 spread by value net of the barramundi credit", () => {
    const r = allocateLanded({ products: [kingfish, barra], credits: [C({ index: 2, itemCode: "15056", totalEx: -16.45 })], poolEx: 5.9091, basis: "value" });
    expect(r.poolCents).toBe(591);
    expect(r.poolEx).toBe(5.91);
    expect(r.allocated).toBe(true);
    const k = r.lines.get(0)!;
    const b = r.lines.get(1)!;
    expect(k.feeShareEx).toBe(3.59);
    expect(b.feeShareEx).toBe(2.32);
    expect(k.feeShareEx + b.feeShareEx).toBeCloseTo(5.91, 10);
    expect(k.landedTotalEx).toBe(131.06);
    expect(k.landedUnitEx).toBe(70.8432); // $70.84 a kg against $68.90 invoiced
    expect(k.landedBaseEx).toBe(70.8432);
    // the barramundi credit has no quantity: the unit cost is not known and a question follows
    expect(b.creditQtyUnknown).toBe(true);
    expect(b.landedTotalEx).toBe(84.85);
    expect(b.landedUnitEx).toBeNull();
    expect(b.landedBaseEx).toBeNull();
    expect(r.attach.get(2)).toBe(1);
  });

  it("works out the unit cost on the quantity kept when the credit states its quantity", () => {
    const r = allocateLanded({
      products: [P({ index: 0, itemCode: "A", qty: 10, baseQty: 10, totalEx: 100 })],
      credits: [C({ index: 1, itemCode: "A", qty: -2, unit: "KG", totalEx: -20 })],
      poolEx: 0,
      basis: "value",
    });
    const l = r.lines.get(0)!;
    expect(l.creditQtyUnknown).toBe(false);
    expect(l.netQty).toBe(8);
    expect(l.landedTotalEx).toBe(80);
    expect(l.landedUnitEx).toBe(10);
    expect(l.landedBaseEx).toBe(10);
  });

  it("spreads by quantity when the supplier asks for it", () => {
    const r = allocateLanded({
      products: [P({ index: 0, baseQty: 3, totalEx: 300 }), P({ index: 1, baseQty: 1, totalEx: 10 })],
      credits: [],
      poolEx: 4,
      basis: "quantity",
    });
    expect(r.lines.get(0)!.feeShareEx).toBe(3);
    expect(r.lines.get(1)!.feeShareEx).toBe(1);
  });

  it("a negative pool (an invoice discount) lowers the landed cost, and still adds up exactly", () => {
    const r = allocateLanded({ products: [P({ index: 0, totalEx: 60 }), P({ index: 1, totalEx: 40 })], credits: [], poolEx: -1.01, basis: "value" });
    const a = r.lines.get(0)!;
    const b = r.lines.get(1)!;
    expect(toCents(a.feeShareEx) + toCents(b.feeShareEx)).toBe(-101);
    expect(a.landedTotalEx).toBeLessThan(60);
  });

  it("leaves the pool unallocated when there is nothing to spread it over", () => {
    const r = allocateLanded({ products: [], credits: [], poolEx: 5, basis: "value" });
    expect(r.allocated).toBe(false);
    expect(r.poolCents).toBe(500);
  });

  it("a line with no total takes no share and gets no landed cost", () => {
    const r = allocateLanded({ products: [P({ index: 0, totalEx: null }), P({ index: 1, totalEx: 10 })], credits: [], poolEx: 2, basis: "value" });
    expect(r.lines.get(0)!.feeShareEx).toBe(0);
    expect(r.lines.get(0)!.landedTotalEx).toBeNull();
    expect(r.lines.get(1)!.feeShareEx).toBe(2);
  });

  it("a zero quantity gives no unit cost (no division by zero)", () => {
    const r = allocateLanded({ products: [P({ index: 0, qty: 0, baseQty: 0, totalEx: 0 })], credits: [], poolEx: 0, basis: "value" });
    expect(r.lines.get(0)!.landedUnitEx).toBeNull();
    expect(r.lines.get(0)!.landedBaseEx).toBeNull();
  });

  it("property: with random invoices the shares always add up to the pool", () => {
    const r = rng(9);
    for (let n = 0; n < 300; n++) {
      const products = Array.from({ length: 1 + Math.floor(r() * 7) }, (_, i) =>
        P({ index: i, itemCode: `C${i}`, qty: 1 + Math.floor(r() * 9), baseQty: 1 + Math.floor(r() * 9), totalEx: Math.round(r() * 100000) / 100 }),
      );
      const pool = Math.round((r() * 200 - 20) * 100) / 100;
      for (const basis of ["value", "quantity"] as const) {
        const res = allocateLanded({ products, credits: [], poolEx: pool, basis });
        if (!res.allocated) continue;
        const total = products.reduce((s, p) => s + toCents(res.lines.get(p.index)!.feeShareEx), 0);
        expect(total).toBe(res.poolCents);
      }
    }
  });
});
