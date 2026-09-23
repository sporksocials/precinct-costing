import { describe, expect, it } from "vitest";
import { gpForPrice, parseGpInput, parsePriceInput, priceForGp } from "@/lib/solver";

const GST = 0.1;

describe("GP ↔ price solver", () => {
  it("computes GP from an inc-GST price", () => {
    // $11 inc → $10 ex; cost $3 → GP 70%
    expect(gpForPrice(3, 11, GST)).toBeCloseTo(0.7);
    expect(gpForPrice(3, null, GST)).toBeNull();
    expect(gpForPrice(3, 0, GST)).toBeNull();
  });

  it("solves a price for a GP, rounded up to 50c", () => {
    expect(priceForGp(3, 0.7, GST, 0.5)).toBe(11);
    expect(priceForGp(3.1, 0.7, GST, 0.5)).toBe(11.5);
    expect(priceForGp(3, 0.99, GST, 0.5)).toBe(330);
    expect(priceForGp(3, 1, GST, 0.5)).toBeNull();
  });

  it("never lands below the requested GP after rounding", () => {
    for (const cost of [0.37, 1.2, 3.33, 4.99, 7.5, 12.01]) {
      for (const gp of [0.6, 0.7, 0.72, 0.75, 0.8]) {
        const p = priceForGp(cost, gp, GST, 0.5)!;
        expect(gpForPrice(cost, p, GST)!).toBeGreaterThanOrEqual(gp - 1e-9);
        // and is the smallest 50c step that does so
        expect(gpForPrice(cost, p - 0.5, GST)!).toBeLessThan(gp + 1e-9);
      }
    }
  });

  it("round-trips price → GP → price for prices on the rounding grid", () => {
    for (const price of [9, 12.5, 18, 24.5]) {
      const gp = gpForPrice(4.2, price, GST)!;
      expect(priceForGp(4.2, gp - 1e-12, GST, 0.5)).toBe(price);
    }
  });

  it("parses typed values", () => {
    expect(parseGpInput("72")).toBeCloseTo(0.72);
    expect(parseGpInput("72.5%")).toBeCloseTo(0.725);
    expect(parseGpInput("0.7")).toBeCloseTo(0.7);
    expect(parseGpInput("")).toBeNull();
    expect(parsePriceInput("$18.50")).toBeCloseTo(18.5);
    expect(parsePriceInput("18,5")).toBeCloseTo(18.5);
    expect(parsePriceInput("abc")).toBeNull();
  });
});
