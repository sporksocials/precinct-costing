import { describe, expect, it } from "vitest";
import { charmPoints, gpAt, ingredientBudget, priceOptions, suggestedAt } from "@/lib/price-picker";

const GST = 0.1;

describe("price picker", () => {
  it("computes GP at a price (ex-GST cost, inc-GST price)", () => {
    const g = gpAt(3, 11, GST);
    expect(g.gpPct).toBeCloseTo(0.7);
    expect(g.gpDollars).toBeCloseTo(7);
  });

  it("suggests at target GP rounded up to the step", () => {
    // cost 5, 72%: 5 / 0.28 * 1.1 = 19.64
    expect(suggestedAt(5, 0.72, GST, 0.5)).toBe(20);
    expect(suggestedAt(5, 0.72, GST, 0.2)).toBe(19.8);
    expect(suggestedAt(0, 0.7, GST, 0.5)).toBe(0);
  });

  it("budget is what you can spend to hit target at a price", () => {
    expect(ingredientBudget(18, 0.72, GST)).toBeCloseTo((18 / 1.1) * 0.28);
  });

  it("charm points are .00 / .50 / .90", () => {
    const p = charmPoints(17, 19);
    expect(p).toContain(17.9);
    expect(p).toContain(18.5);
    expect(p).toContain(19);
  });

  it("builds two below, the suggestion, three above, ascending", () => {
    const o = priceOptions({ cost: 5, target: 0.72, gst: GST, step: 0.5 });
    expect(o).toHaveLength(6);
    expect(o.map((x) => x.price)).toEqual([...o.map((x) => x.price)].sort((a, b) => a - b));
    expect(o.filter((x) => x.kind === "suggested")).toHaveLength(1);
    expect(o[2].kind).toBe("suggested");
    expect(o[2].price).toBe(20);
    expect(o[2].belowTarget).toBe(false);
    expect(o[0].belowTarget).toBe(true);
    expect(o[5].gpPct).toBeGreaterThan(o[2].gpPct);
  });

  it("adds an off-list current price and returns nothing without cost", () => {
    const o = priceOptions({ cost: 5, target: 0.72, gst: GST, step: 0.5, current: 21.3 });
    expect(o.some((x) => x.kind === "current" && x.price === 21.3)).toBe(true);
    expect(priceOptions({ cost: 0, target: 0.7, gst: GST, step: 0.5 })).toEqual([]);
  });
});
